import type { Prisma } from "@prisma/client";

type AdvisoryLockClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export function researchLedgerTaskLockIdentity(taskId: string) {
  const normalized = taskId.normalize("NFKC").trim();
  if (!normalized || normalized.length > 200) {
    throw new TypeError("A research task lock requires a bounded task id.");
  }
  return `research-ledger:${normalized}`;
}

/**
 * Serialize every mutation of one completed research task. Callers must take
 * this transaction-scoped lock before re-reading the task state they intend
 * to claim, import, retry, or rematerialize.
 */
export async function acquireResearchLedgerTaskLock(
  database: AdvisoryLockClient,
  taskId: string,
) {
  const identity = researchLedgerTaskLockIdentity(taskId);
  await database.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))::text AS lock_result`;
}
