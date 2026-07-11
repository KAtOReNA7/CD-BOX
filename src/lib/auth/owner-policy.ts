export const DEFAULT_ALLOWED_GITHUB_ID = "26319181";
export const DEFAULT_ALLOWED_GITHUB_LOGIN = "KAtOReNA7";

export type AuthorizedOwnerIdentity = {
  id: string;
  githubId: string;
  githubLogin: string;
  name: string;
  image: string | null;
};

type SessionUserIdentity = {
  id?: string | null;
  githubId?: string | null;
  githubLogin?: string | null;
  name?: string | null;
  image?: string | null;
};

export function resolveAllowedGitHubId(value: string | undefined) {
  return value?.trim() || DEFAULT_ALLOWED_GITHUB_ID;
}

export function resolveAllowedGitHubLogin(value: string | undefined) {
  return value?.trim() || DEFAULT_ALLOWED_GITHUB_LOGIN;
}

export function normalizeGitHubId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return /^[1-9]\d*$/.test(normalized) ? normalized : null;
}

export function extractGitHubId(profile: unknown): string | null {
  if (!profile || typeof profile !== "object" || !("id" in profile)) {
    return null;
  }

  return normalizeGitHubId((profile as { id?: unknown }).id);
}

export function extractGitHubLogin(profile: unknown): string | null {
  if (!profile || typeof profile !== "object" || !("login" in profile)) {
    return null;
  }

  const login = (profile as { login?: unknown }).login;
  return typeof login === "string" && login.trim() ? login.trim() : null;
}

export function isAllowedGitHubId(githubId: unknown, allowedGithubId: unknown) {
  const normalizedId = normalizeGitHubId(githubId);
  const normalizedAllowedId = normalizeGitHubId(allowedGithubId);
  return Boolean(normalizedId && normalizedAllowedId && normalizedId === normalizedAllowedId);
}

export function authorizeOwnerIdentity(
  user: SessionUserIdentity | null | undefined,
  allowedGithubId: string,
  fallbackGithubLogin = DEFAULT_ALLOWED_GITHUB_LOGIN,
): AuthorizedOwnerIdentity | null {
  const id = user?.id?.trim();
  const githubId = normalizeGitHubId(user?.githubId);

  if (!id || !githubId || !isAllowedGitHubId(githubId, allowedGithubId)) {
    return null;
  }

  const githubLogin = user?.githubLogin?.trim() || resolveAllowedGitHubLogin(fallbackGithubLogin);

  return {
    id,
    githubId,
    githubLogin,
    name: user?.name?.trim() || githubLogin,
    image: user?.image ?? null,
  };
}
