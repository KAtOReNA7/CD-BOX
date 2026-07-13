import { pathToFileURL } from "node:url";
import {
  processScheduledCoverRetryBatch,
  sanitizeScheduledCoverRetryError,
  type ScheduledCoverRetryBatchResult,
  type ScheduledCoverRetryProgress,
} from "../src/lib/ai/scheduled-cover-retry";

export type SelectedTaskCoverRetryOptions = {
  taskIds: string[];
  maxBatches: number;
};

type SelectedTaskCoverRetryEvent = {
  event: "selected-task-cover-retry";
  batch: number;
  skippedForActiveResearch: boolean;
  taskId: string | null;
  attempted: number;
  found: number;
  pending: number | null;
};

type SelectedTaskCoverRetryProgressEvent = {
  event: "selected-task-cover-retry-progress";
  batch: number;
  taskId: string;
  completed: number;
  total: number;
  found: number;
  pending: number;
};

type SelectedTaskCoverRetryDependencies = {
  processBatch: (
    now: Date,
    options: {
      taskIds: readonly string[];
      candidateBatchSize: number;
      onProgress?: (progress: ScheduledCoverRetryProgress) => void | Promise<void>;
    },
  ) => Promise<ScheduledCoverRetryBatchResult>;
  now: () => Date;
  emit: (event: SelectedTaskCoverRetryEvent | SelectedTaskCoverRetryProgressEvent) => void;
};

export function parseSelectedTaskCoverRetryOptions(
  args: readonly string[],
): SelectedTaskCoverRetryOptions {
  const taskArguments = args.filter((argument) => argument.startsWith("--task-ids="));
  const maxArguments = args.filter((argument) => argument.startsWith("--max-batches="));
  const hasUnknown = args.some((argument) =>
    !argument.startsWith("--task-ids=") && !argument.startsWith("--max-batches="));
  if (hasUnknown) {
    throw new Error("Unknown option. Allowed options are --task-ids and --max-batches.");
  }
  if (taskArguments.length !== 1) {
    throw new Error("Exactly one --task-ids option is required.");
  }
  if (maxArguments.length > 1) {
    throw new Error("--max-batches may be provided only once.");
  }

  const taskIds = [...new Set(taskArguments[0].slice("--task-ids=".length)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean))];
  if (taskIds.length === 0) throw new Error("--task-ids requires at least one task id.");
  if (taskIds.length > 64) throw new Error("--task-ids accepts at most 64 task ids.");
  if (taskIds.some((taskId) => !/^[a-z0-9_-]{8,128}$/iu.test(taskId))) {
    throw new Error("--task-ids contains an invalid task id.");
  }
  const parsedMaximum = Number(maxArguments[0]?.slice("--max-batches=".length) ?? 16);
  if (!Number.isInteger(parsedMaximum) || parsedMaximum < 1 || parsedMaximum > 64) {
    throw new Error("--max-batches must be an integer from 1 through 64.");
  }
  return { taskIds, maxBatches: parsedMaximum };
}

export async function runSelectedTaskCoverRetries(
  options: SelectedTaskCoverRetryOptions,
  dependencyOverrides: Partial<SelectedTaskCoverRetryDependencies> = {},
) {
  const dependencies: SelectedTaskCoverRetryDependencies = {
    processBatch: processScheduledCoverRetryBatch,
    now: () => new Date(),
    emit: (event) => console.log(JSON.stringify(event)),
    ...dependencyOverrides,
  };
  let attempted = 0;
  let found = 0;
  let batchesProcessed = 0;
  const processedTaskIds = new Set<string>();
  for (let batch = 1; batch <= options.maxBatches; batch += 1) {
    const remainingTaskIds = options.taskIds.filter((taskId) => !processedTaskIds.has(taskId));
    if (remainingTaskIds.length === 0) break;
    const remainingTaskIdSet = new Set(remainingTaskIds);
    const result = await dependencies.processBatch(dependencies.now(), {
      taskIds: remainingTaskIds,
      candidateBatchSize: 64,
      onProgress: (progress) => dependencies.emit({
        event: "selected-task-cover-retry-progress",
        batch,
        taskId: progress.taskId,
        completed: progress.completed,
        total: progress.total,
        found: progress.found,
        pending: progress.pending,
      }),
    });
    const item = result.tasks[0] ?? null;
    if (item && !remainingTaskIdSet.has(item.taskId)) {
      throw new TypeError("The selected cover retry returned a task outside its remaining allowlist.");
    }
    dependencies.emit({
      event: "selected-task-cover-retry",
      batch,
      skippedForActiveResearch: result.skippedForActiveResearch,
      taskId: item?.taskId ?? null,
      attempted: item?.attempted ?? 0,
      found: item?.found ?? 0,
      pending: item?.pending ?? null,
    });
    batchesProcessed = batch;
    if (result.skippedForActiveResearch || !item) break;
    processedTaskIds.add(item.taskId);
    attempted += item.attempted;
    found += item.found;
  }
  return { attempted, found, batchesProcessed };
}

async function main() {
  await runSelectedTaskCoverRetries(parseSelectedTaskCoverRetryOptions(process.argv.slice(2)));
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify({
      event: "selected-task-cover-retry-fatal",
      errorType: error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/u.test(error.name)
        ? error.name
        : "Error",
      errorMessage: sanitizeScheduledCoverRetryError(error),
    }));
    process.exitCode = 1;
  });
}
