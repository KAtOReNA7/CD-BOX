import Link from "next/link";
import { Archive, Database, LogIn, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="min-h-screen bg-stone-50 text-stone-950">
      <section className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-12 px-6 py-10 lg:grid-cols-[1fr_420px] lg:items-center">
        <div className="max-w-3xl">
          <div className="mb-8 flex items-center gap-3 font-semibold">
            <span className="flex size-10 items-center justify-center rounded-md bg-stone-950 text-white">
              <Archive className="size-5" />
            </span>
            CD-BOX
          </div>
          <p className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-stone-500">
            Physical CD Collection Database
          </p>
          <h1 className="text-5xl font-semibold leading-tight text-stone-950 md:text-6xl">
            为实体 CD 收藏建立可靠的本机资料库。
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-600">
            按艺人管理原创专辑、单曲、精选、现场、混音和 BOX。保留真实来源 URL，
            由权威数据源与 AI 交叉核验发行信息，并在这台电脑上保存收藏状态。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/dashboard" className="gap-2">
                <LogIn className="size-4" />
                进入控制台
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/import">查看导入</Link>
            </Button>
          </div>
        </div>

        <div className="border bg-white p-6 shadow-sm">
          <div className="grid gap-4">
            <div className="flex items-start gap-4 border-b pb-4">
              <Database className="mt-1 size-5 text-stone-500" />
              <div>
                <h2 className="font-semibold">本机收藏状态</h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  本机 PostgreSQL + Prisma 保存艺人库、发行、来源和收藏状态。
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <ShieldCheck className="mt-1 size-5 text-stone-500" />
              <div>
                <h2 className="font-semibold">真实封面原则</h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  最终条目仅使用权威数据源中的真实 CD 封面，不使用 AI 生成图冒充。
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
