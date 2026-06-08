import { Bot } from "lucide-react";
import { AppShell } from "@/components/app/app-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { aiConfig } from "@/lib/ai/client";

export default function AiSearchPage() {
  return (
    <AppShell>
      <div className="max-w-3xl">
        <p className="text-sm font-medium text-muted-foreground">AI Research</p>
        <h1 className="mt-2 text-3xl font-semibold">AI 搜索与结构化占位</h1>
        <Alert className="mt-8">
          <Bot className="size-4" />
          <AlertTitle>统一 AI 入口已建立</AlertTitle>
          <AlertDescription>
            搜索、整理、去重和结构化将统一通过 src/lib/ai/client.ts 调用 {aiConfig.textModel}。
            UI 美术资产占位使用 {aiConfig.imageModel}，真实 CD 封面不走生图。
          </AlertDescription>
        </Alert>
        <div className="mt-6 border bg-white p-6">
          <Textarea placeholder="输入艺人名、发行范围、需要核对的版本信息" rows={7} />
          <Button type="button" className="mt-4">
            创建 AI 搜索任务
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
