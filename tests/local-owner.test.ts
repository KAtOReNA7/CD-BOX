import assert from "node:assert/strict";
import {
  LOCAL_OWNER_HANDLE,
  LOCAL_OWNER_NAME,
  LOCAL_OWNER_USER_ID,
} from "@/lib/auth/local-owner-policy";
import { upsertLocalOwner, type LocalOwnerStore } from "@/lib/auth/local-owner";

async function main() {
  let receivedInput: Parameters<LocalOwnerStore["upsert"]>[0] | null = null;
  const owner = await upsertLocalOwner({
    async upsert(input) {
      receivedInput = input;
      return { id: input.id, name: "  Personal CD owner  ", image: null };
    },
  });

  assert.deepEqual(receivedInput, { id: LOCAL_OWNER_USER_ID, name: LOCAL_OWNER_NAME });
  assert.deepEqual(owner, {
    id: LOCAL_OWNER_USER_ID,
    authMode: "local",
    handle: LOCAL_OWNER_HANDLE,
    name: "Personal CD owner",
    image: null,
  });

  await assert.rejects(
    upsertLocalOwner({
      async upsert() {
        return { id: "unexpected-owner", name: null, image: null };
      },
    }),
    /unexpected user id/,
  );

  console.log("Local owner upsert test passed.");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
