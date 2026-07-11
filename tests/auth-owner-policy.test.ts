import assert from "node:assert/strict";
import {
  DEFAULT_ALLOWED_GITHUB_ID,
  DEFAULT_ALLOWED_GITHUB_LOGIN,
  authorizeOwnerIdentity,
  extractGitHubId,
  extractGitHubLogin,
  isAllowedGitHubId,
  normalizeGitHubId,
  resolveAllowedGitHubId,
  resolveAllowedGitHubLogin,
} from "@/lib/auth/owner-policy";

assert.equal(resolveAllowedGitHubId(undefined), DEFAULT_ALLOWED_GITHUB_ID);
assert.equal(resolveAllowedGitHubId("  123456  "), "123456");
assert.equal(resolveAllowedGitHubLogin(undefined), DEFAULT_ALLOWED_GITHUB_LOGIN);
assert.equal(resolveAllowedGitHubLogin("  another-owner  "), "another-owner");
assert.equal(normalizeGitHubId(26319181), "26319181");
assert.equal(normalizeGitHubId(" 26319181 "), "26319181");
assert.equal(normalizeGitHubId(0), null);
assert.equal(normalizeGitHubId(1.5), null);
assert.equal(normalizeGitHubId("not-a-number"), null);
assert.equal(extractGitHubId({ id: 26319181 }), "26319181");
assert.equal(extractGitHubId({ id: "26319181" }), "26319181");
assert.equal(extractGitHubId({ login: "KAtOReNA7" }), null);
assert.equal(extractGitHubLogin({ login: "  KAtOReNA7 " }), "KAtOReNA7");
assert.equal(extractGitHubLogin({ name: "KAtOReNA7" }), null);
assert.equal(extractGitHubLogin(null), null);

assert.equal(isAllowedGitHubId("26319181", "26319181"), true);
assert.equal(isAllowedGitHubId(26319181, "26319181"), true);
assert.equal(isAllowedGitHubId("26319182", "26319181"), false);
assert.equal(isAllowedGitHubId(null, "26319181"), false);
assert.equal(isAllowedGitHubId("26319181", "invalid"), false);

assert.deepEqual(
  authorizeOwnerIdentity(
    {
      id: "user-1",
      githubId: "26319181",
      githubLogin: "renamed-owner",
      name: null,
      image: "https://avatars.example.test/owner.png",
    },
    "26319181",
  ),
  {
    id: "user-1",
    githubId: "26319181",
    githubLogin: "renamed-owner",
    name: "renamed-owner",
    image: "https://avatars.example.test/owner.png",
  },
);
assert.equal(
  authorizeOwnerIdentity(
    { id: "user-2", githubId: "26319182", githubLogin: "KAtOReNA7" },
    "26319181",
  ),
  null,
);
assert.equal(
  authorizeOwnerIdentity({ id: "", githubId: "26319181", githubLogin: "KAtOReNA7" }, "26319181"),
  null,
);
assert.equal(
  authorizeOwnerIdentity({ id: "user-3", githubLogin: "KAtOReNA7" }, "26319181"),
  null,
);
assert.deepEqual(
  authorizeOwnerIdentity({ id: "user-4", githubId: "26319181" }, "26319181", "KAtOReNA7"),
  {
    id: "user-4",
    githubId: "26319181",
    githubLogin: "KAtOReNA7",
    name: "KAtOReNA7",
    image: null,
  },
);

console.log("GitHub owner policy test passed.");
