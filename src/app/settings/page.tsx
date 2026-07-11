import { AppShell } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { requirePageOwner } from "@/lib/auth/current-user";

const envItems = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "LOCAL_OWNER_MODE",
  "LOCAL_OWNER_BIND_HOST",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_TEXT_MODEL",
  "OPENAI_IMAGE_MODEL",
  "AI_TEXT_PROTOCOL",
  "AI_ENABLE_WEB_SEARCH",
  "AI_ORGANIZE_PUBLIC_METADATA",
];

export default async function SettingsPage() {
  await requirePageOwner();

  return (
    <AppShell>
      <div className="max-w-3xl">
        <p className="text-sm font-medium text-muted-foreground">Settings</p>
        <h1 className="mt-2 text-3xl font-semibold">系统设置</h1>
        <div className="mt-8 grid gap-3 border bg-white p-6">
          {envItems.map((item) => (
            <div key={item} className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
              <Label htmlFor={item}>{item}</Label>
              <Badge variant="outline">env</Badge>
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-2 border bg-white p-6">
          <Label htmlFor="cover">手动封面 URL 示例</Label>
          <Input id="cover" placeholder="https://example.com/real-cd-cover.jpg" />
          <p className="text-sm text-muted-foreground">
            CD-BOX 只保存真实封面图 URL；本机版本不需要对象存储服务。
          </p>
        </div>
      </div>
    </AppShell>
  );
}
