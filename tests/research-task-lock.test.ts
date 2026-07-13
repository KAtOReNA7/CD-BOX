import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { assertResearchImportTaskSnapshotUnchanged } from "@/lib/ai/release-research";
import {
  acquireResearchLedgerTaskLock,
  researchLedgerTaskLockIdentity,
} from "@/lib/ai/research-task-lock";

function importSnapshot() {
  return {
    id: "task-0001",
    userId: "owner-0001",
    query: "Fixture Artist",
    request: { artistName: "Fixture Artist" },
    pipelineVersion: "multi-source-v2",
    resultSchemaVersion: 2,
    status: "SUCCEEDED" as const,
    rawResult: { evidence: { version: 2 } },
    parsedResult: { releases: [{ id: "candidate-1" }] },
    artistId: null,
    importedAt: null,
    updatedAt: new Date("2026-07-12T06:00:00.000Z"),
  };
}

test("research task mutations share one normalized advisory-lock identity", async () => {
  assert.equal(
    researchLedgerTaskLockIdentity("  task-0001  "),
    "research-ledger:task-0001",
  );
  assert.throws(
    () => researchLedgerTaskLockIdentity(" "),
    /bounded task id/,
  );

  const values: unknown[] = [];
  const database = {
    $queryRaw(_strings: TemplateStringsArray, ...parameters: unknown[]) {
      values.push(...parameters);
      return Promise.resolve([]);
    },
  } as unknown as Pick<Prisma.TransactionClient, "$queryRaw">;
  await acquireResearchLedgerTaskLock(database, "task-0001");
  assert.deepEqual(values, ["research-ledger:task-0001"]);
});

test("import rejects a task rematerialized while it waited for the shared lock", () => {
  const original = importSnapshot();
  const unchanged = structuredClone(original);
  assert.doesNotThrow(() =>
    assertResearchImportTaskSnapshotUnchanged(original, unchanged));

  const rematerialized = structuredClone(original);
  rematerialized.updatedAt = new Date("2026-07-12T06:01:00.000Z");
  rematerialized.parsedResult = { releases: [{ id: "candidate-2" }] };
  assert.throws(
    () => assertResearchImportTaskSnapshotUnchanged(original, rematerialized),
    /[\s\S]+/,
  );

  const imported = {
    ...structuredClone(original),
    artistId: "artist-0001",
    importedAt: new Date("2026-07-12T06:01:00.000Z"),
  };
  assert.throws(
    () => assertResearchImportTaskSnapshotUnchanged(original, imported),
    /[\s\S]+/,
  );
});
