import "server-only";

import { cache } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  authorizeOwnerIdentity,
  resolveAllowedGitHubId,
  resolveAllowedGitHubLogin,
  type AuthorizedOwnerIdentity,
} from "@/lib/auth/owner-policy";

export type AuthenticatedOwner = AuthorizedOwnerIdentity;

export const getCurrentOwner = cache(async (): Promise<AuthenticatedOwner | null> => {
  const session = await getServerSession(authOptions);
  const allowedGithubId = resolveAllowedGitHubId(process.env.AUTH_GITHUB_ALLOWED_ID);
  const fallbackGithubLogin = resolveAllowedGitHubLogin(process.env.AUTH_GITHUB_ALLOWED_LOGIN);
  return authorizeOwnerIdentity(session?.user, allowedGithubId, fallbackGithubLogin);
});

export async function getCurrentUserId() {
  return (await getCurrentOwner())?.id ?? null;
}

export async function requirePageOwner() {
  const owner = await getCurrentOwner();

  if (!owner) {
    redirect("/api/auth/signin?callbackUrl=/dashboard");
  }

  return owner;
}

export type ApiOwnerResult =
  | { authorized: true; owner: AuthenticatedOwner }
  | { authorized: false; response: NextResponse<{ error: string }> };

export async function requireApiOwner(): Promise<ApiOwnerResult> {
  const owner = await getCurrentOwner();

  if (!owner) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 }),
    };
  }

  return { authorized: true, owner };
}
