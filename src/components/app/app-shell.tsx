import Link from "next/link";
import { Archive, Bot, Home, Import, Settings, UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/artists/new", label: "艺人收藏库", icon: UserRoundPlus },
  { href: "/import", label: "导入", icon: Import },
  { href: "/ai-search", label: "资料整理", icon: Bot },
  { href: "/settings", label: "设置", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-950">
      <header className="border-b bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3 font-semibold">
            <span className="flex size-9 items-center justify-center rounded-md bg-stone-950 text-white">
              <Archive className="size-5" />
            </span>
            <span>CD-BOX</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <Button key={item.href} asChild variant="ghost" size="sm">
                <Link href={item.href} className="gap-2">
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              </Button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
