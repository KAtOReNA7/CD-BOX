import "server-only";

import { prisma } from "@/lib/db/prisma";
import {
  LOCAL_OWNER_HANDLE,
  LOCAL_OWNER_NAME,
  LOCAL_OWNER_USER_ID,
} from "@/lib/auth/local-owner-policy";

export type LocalOwnerIdentity = {
  id: string;
  authMode: "local";
  handle: string;
  name: string;
  image: string | null;
};

type LocalOwnerRecord = {
  id: string;
  name: string | null;
  image: string | null;
};

export type LocalOwnerStore = {
  upsert(input: { id: string; name: string }): Promise<LocalOwnerRecord>;
};

const prismaLocalOwnerStore: LocalOwnerStore = {
  async upsert(input) {
    return prisma.user.upsert({
      where: { id: input.id },
      create: { id: input.id, name: input.name },
      update: { name: input.name },
      select: { id: true, name: true, image: true },
    });
  },
};

export async function upsertLocalOwner(
  store: LocalOwnerStore = prismaLocalOwnerStore,
): Promise<LocalOwnerIdentity> {
  const user = await store.upsert({ id: LOCAL_OWNER_USER_ID, name: LOCAL_OWNER_NAME });

  if (user.id !== LOCAL_OWNER_USER_ID) {
    throw new Error("The local owner store returned an unexpected user id.");
  }

  return {
    id: user.id,
    authMode: "local",
    handle: LOCAL_OWNER_HANDLE,
    name: user.name?.trim() || LOCAL_OWNER_NAME,
    image: user.image,
  };
}
