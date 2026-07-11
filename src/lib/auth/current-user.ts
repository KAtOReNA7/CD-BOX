import "server-only";

import { cache } from "react";
import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { upsertLocalOwner } from "@/lib/auth/local-owner";
import {
  isLocalOwnerRequestAllowed,
  readLocalOwnerRequestMetadata,
  resolveLocalOwnerConfiguration,
} from "@/lib/auth/local-owner-policy";
import {
  authorizeOwnerIdentity,
  resolveAllowedGitHubId,
  resolveAllowedGitHubLogin,
  type AuthorizedOwnerIdentity,
} from "@/lib/auth/owner-policy";

export type AuthenticatedOwner = {
  id: string;
  authMode: "github" | "local";
  handle: string;
  name: string;
  image: string | null;
  githubId: string | null;
  githubLogin: string | null;
};

function fromGitHubOwner(owner: AuthorizedOwnerIdentity): AuthenticatedOwner {
  return {
    ...owner,
    authMode: "github",
    handle: owner.githubLogin,
  };
}

export const getCurrentOwner = cache(async (): Promise<AuthenticatedOwner | null> => {
  const localOwnerConfiguration = resolveLocalOwnerConfiguration();
  if (localOwnerConfiguration.status !== "disabled") {
    if (localOwnerConfiguration.status !== "enabled") {
      return null;
    }

    const requestHeaders = await headers();
    const request = readLocalOwnerRequestMetadata(requestHeaders);
    if (!isLocalOwnerRequestAllowed(localOwnerConfiguration, request)) {
      return null;
    }

    const owner = await upsertLocalOwner();
    return { ...owner, githubId: null, githubLogin: null };
  }

  const session = await getServerSession(authOptions);
  const allowedGithubId = resolveAllowedGitHubId(process.env.AUTH_GITHUB_ALLOWED_ID);
  const fallbackGithubLogin = resolveAllowedGitHubLogin(process.env.AUTH_GITHUB_ALLOWED_LOGIN);
  const owner = authorizeOwnerIdentity(session?.user, allowedGithubId, fallbackGithubLogin);
  return owner ? fromGitHubOwner(owner) : null;
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
