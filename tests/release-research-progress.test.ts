import assert from "node:assert/strict";
import test from "node:test";
import {
  createResearchProgressCoordinator,
  resolveResearchCoverRetryProgress,
} from "@/lib/ai/release-research";

test("research progress is serialized, monotonic, and sealed before terminal state", async () => {
  const writes: Array<{ progress: number; stage: string }> = [];
  let activeWrites = 0;
  let maximumActiveWrites = 0;
  let releaseHeartbeat!: () => void;
  const heartbeatGate = new Promise<void>((resolve) => {
    releaseHeartbeat = resolve;
  });
  const coordinator = createResearchProgressCoordinator(async (update) => {
    activeWrites += 1;
    maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
    if (update.stage === "AI heartbeat") await heartbeatGate;
    writes.push(update);
    activeWrites -= 1;
  }, 77);

  const heartbeat = coordinator.report(80, "AI heartbeat");
  const cover = coordinator.report(86, "cover validation");
  const staleHeartbeat = coordinator.report(85, "late AI heartbeat");
  assert.equal(await staleHeartbeat, false);

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(activeWrites, 1);
  releaseHeartbeat();
  assert.equal(await heartbeat, true);
  assert.equal(await cover, true);
  assert.equal(maximumActiveWrites, 1);
  assert.deepEqual(writes, [
    { progress: 80, stage: "AI heartbeat" },
    { progress: 86, stage: "cover validation" },
  ]);

  await coordinator.seal();
  assert.equal(await coordinator.report(100, "late completion overwrite"), false);
  assert.deepEqual(writes.map((update) => update.stage), ["AI heartbeat", "cover validation"]);
});

test("research progress permits a newer label at the same percentage", async () => {
  const writes: Array<{ progress: number; stage: string }> = [];
  const coordinator = createResearchProgressCoordinator(async (update) => {
    writes.push(update);
  }, 77);

  await Promise.all([
    coordinator.report(77, "AI batch started"),
    coordinator.report(77, "AI batch heartbeat"),
  ]);
  await coordinator.seal();
  assert.deepEqual(writes, [
    { progress: 77, stage: "AI batch started" },
    { progress: 77, stage: "AI batch heartbeat" },
  ]);
});

test("cover retry round two immediately reports a monotonic stage", async () => {
  const writes: Array<{ progress: number; stage: string }> = [];
  const coordinator = createResearchProgressCoordinator(async (update) => {
    writes.push(update);
  }, 93);

  await coordinator.report(
    resolveResearchCoverRetryProgress(coordinator.current(), 2, 2),
    "cover retry round 1 (2/2)",
  );
  await coordinator.report(
    resolveResearchCoverRetryProgress(coordinator.current(), 0, 2),
    "cover retry round 2 (0/2)",
  );
  await coordinator.seal();

  assert.deepEqual(writes, [
    { progress: 94, stage: "cover retry round 1 (2/2)" },
    { progress: 94, stage: "cover retry round 2 (0/2)" },
  ]);
});
