import { OperationProgress } from "@/components/app/operation-progress";

export default function Loading() {
  return (
    <main className="mx-auto grid min-h-72 w-full max-w-7xl place-items-center px-6 py-8">
      <div className="w-full max-w-md">
        <OperationProgress
          label="正在加载页面…"
          detail="正在读取收藏库，请稍候。"
        />
      </div>
    </main>
  );
}
