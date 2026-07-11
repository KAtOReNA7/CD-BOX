import "server-only";

import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/prisma";
import {
  extractGitHubId,
  extractGitHubLogin,
  isAllowedGitHubId,
  normalizeGitHubId,
  resolveAllowedGitHubId,
} from "@/lib/auth/owner-policy";

const providers: NextAuthOptions["providers"] = [];

if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(
    GitHubProvider({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  );
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "github") {
        return false;
      }

      const githubId = normalizeGitHubId(account.providerAccountId) ?? extractGitHubId(profile);
      const allowedGithubId = resolveAllowedGitHubId(process.env.AUTH_GITHUB_ALLOWED_ID);
      return isAllowedGitHubId(githubId, allowedGithubId);
    },
    async jwt({ token, user, account, profile }) {
      if (user?.id) {
        token.userId = user.id;
      }

      if (account?.provider === "github") {
        const githubId = normalizeGitHubId(account.providerAccountId) ?? extractGitHubId(profile);
        const login = extractGitHubLogin(profile);
        if (githubId) {
          token.githubId = githubId;
        }
        if (login) {
          token.githubLogin = login;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId ?? token.sub ?? "";
        session.user.githubId = token.githubId ?? "";
        session.user.githubLogin = token.githubLogin ?? "";
      }

      return session;
    },
  },
};
