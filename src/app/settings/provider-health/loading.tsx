import { OperationProgress } from "@/components/app/operation-progress";

export default function ProviderHealthLoading() {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <OperationProgress
        label="正在检查 AI 服务…"
        detail="完整 Responses 或联网搜索检查可能需要几分钟，请保持页面打开。"
      />
    </main>
  );
}
