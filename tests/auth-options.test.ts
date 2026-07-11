import assert from "node:assert/strict";
import { authOptions } from "@/lib/auth/options";

async function main() {
  const signIn = authOptions.callbacks?.signIn;
  const jwt = authOptions.callbacks?.jwt;
  const sessionCallback = authOptions.callbacks?.session;

  assert.ok(signIn);
  assert.ok(jwt);
  assert.ok(sessionCallback);

  const previousAllowedId = process.env.AUTH_GITHUB_ALLOWED_ID;
  const previousLocalOwnerMode = process.env.LOCAL_OWNER_MODE;
  process.env.AUTH_GITHUB_ALLOWED_ID = "26319181";
  delete process.env.LOCAL_OWNER_MODE;

  try {
    assert.equal(
      await signIn({
        user: { id: "owner-user" },
        account: {
          provider: "github",
          providerAccountId: "26319181",
          type: "oauth",
        },
        profile: { id: 26319181, login: "renamed-owner" },
      } as Parameters<typeof signIn>[0]),
      true,
    );

    assert.equal(
      await signIn({
        user: { id: "lookalike-user" },
        account: {
          provider: "github",
          providerAccountId: "26319182",
          type: "oauth",
        },
        profile: { id: 26319182, login: "KAtOReNA7" },
      } as Parameters<typeof signIn>[0]),
      false,
    );

    process.env.LOCAL_OWNER_MODE = "true";
    assert.equal(
      await signIn({
        user: { id: "owner-user" },
        account: {
          provider: "github",
          providerAccountId: "26319181",
          type: "oauth",
        },
        profile: { id: 26319181, login: "renamed-owner" },
      } as Parameters<typeof signIn>[0]),
      false,
    );
    delete process.env.LOCAL_OWNER_MODE;

    assert.equal(
      await signIn({
        user: { id: "other-provider-user" },
        account: {
          provider: "google",
          providerAccountId: "26319181",
          type: "oauth",
        },
        profile: { id: 26319181, login: "KAtOReNA7" },
      } as Parameters<typeof signIn>[0]),
      false,
    );

    const token = await jwt({
      token: { sub: "owner-user" },
      user: { id: "owner-user" },
      account: {
        provider: "github",
        providerAccountId: "26319181",
        type: "oauth",
      },
      profile: { id: 26319181, login: "renamed-owner" },
      trigger: "signIn",
      isNewUser: false,
    } as Parameters<typeof jwt>[0]);

    assert.equal(token.userId, "owner-user");
    assert.equal(token.githubId, "26319181");
    assert.equal(token.githubLogin, "renamed-owner");

    const session = await sessionCallback({
      session: {
        user: { name: "Owner", email: null, image: null },
        expires: new Date(Date.now() + 60_000).toISOString(),
      },
      token,
    } as Parameters<typeof sessionCallback>[0]);
    const sessionUser = session.user as
      | { id?: string; githubId?: string; githubLogin?: string }
      | undefined;

    assert.equal(sessionUser?.id, "owner-user");
    assert.equal(sessionUser?.githubId, "26319181");
    assert.equal(sessionUser?.githubLogin, "renamed-owner");
  } finally {
    if (previousAllowedId === undefined) {
      delete process.env.AUTH_GITHUB_ALLOWED_ID;
    } else {
      process.env.AUTH_GITHUB_ALLOWED_ID = previousAllowedId;
    }
    if (previousLocalOwnerMode === undefined) {
      delete process.env.LOCAL_OWNER_MODE;
    } else {
      process.env.LOCAL_OWNER_MODE = previousLocalOwnerMode;
    }
  }

  console.log("GitHub auth callback test passed.");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
