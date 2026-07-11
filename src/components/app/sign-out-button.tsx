"use client";

import { useState } from "react";
import { LoaderCircle, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await signOut({ callbackUrl: "/" });
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "退出失败，请稍后重试。");
    }
  }

  return (
    <div className="grid justify-items-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-2"
        disabled={pending}
        aria-busy={pending}
        aria-label={pending ? "正在退出登录" : "退出登录"}
        onClick={handleSignOut}
      >
        {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <LogOut className="size-4" aria-hidden="true" />}
        <span className="hidden sm:inline">{pending ? "退出中…" : "退出"}</span>
      </Button>
      {error ? <p className="max-w-48 text-right text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
