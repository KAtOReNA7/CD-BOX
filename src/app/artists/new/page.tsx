import { AppShell } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function NewArtistPage() {
  return (
    <AppShell>
      <div className="max-w-2xl">
        <p className="text-sm font-medium text-muted-foreground">Artist Library</p>
        <h1 className="mt-2 text-3xl font-semibold">新建艺人库</h1>
        <form className="mt-8 grid gap-6 border bg-white p-6">
          <div className="grid gap-2">
            <Label htmlFor="name">艺人名称</Label>
            <Input id="name" name="name" placeholder="例如：宇多田ヒカル" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sortName">排序名</Label>
            <Input id="sortName" name="sortName" placeholder="例如：Utada Hikaru" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="country">国家/地区</Label>
            <Input id="country" name="country" placeholder="Japan" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">备注</Label>
            <Textarea id="description" name="description" placeholder="收藏范围、版本偏好、资料来源说明" />
          </div>
          <Button type="button" className="w-fit">
            保存艺人库
          </Button>
        </form>
      </div>
    </AppShell>
  );
}
