"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="gap-2"
      onClick={() => signOut({ callbackUrl: "/" })}
    >
      <LogOut className="size-4" />
      <span className="hidden sm:inline">退出</span>
    </Button>
  );
}
