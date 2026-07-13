import { setTimeout as delay } from "node:timers/promises";
import {
  processScheduledCoverRetryBatch,
  sanitizeScheduledCoverRetryError,
} from "../src/lib/ai/scheduled-cover-retry";
import { prisma } from "../src/lib/db/prisma";

const POLL_INTERVAL_MS = 60_000;
const STARTUP_DELAY_MS = 5_000;
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

async function main() {
  await delay(STARTUP_DELAY_MS);
  while (!stopping) {
    try {
      const result = await processScheduledCoverRetryBatch();
      for (const task of result.tasks) {
        process.stdout.write(`${JSON.stringify({
          event: "scheduled-cover-retry",
          ...task,
          checkedAt: new Date().toISOString(),
        })}\n`);
      }
    } catch (error) {
      process.stderr.write(`${JSON.stringify({
        event: "scheduled-cover-retry-error",
        message: sanitizeScheduledCoverRetryError(error),
        checkedAt: new Date().toISOString(),
      })}\n`);
    }
    if (!stopping) await delay(POLL_INTERVAL_MS);
  }
}

void main()
  .catch((error) => {
    process.stderr.write(`${JSON.stringify({
      event: "scheduled-cover-retry-fatal",
      message: sanitizeScheduledCoverRetryError(error),
      checkedAt: new Date().toISOString(),
    })}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
